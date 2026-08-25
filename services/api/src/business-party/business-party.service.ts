import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertValidUnifiedSocialCreditCode } from "../company-entity/unified-social-credit-code";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { bumpContractAggregateRevision } from "../contract-workbench/contract-render-input-revision";
import { PrismaService } from "../database/prisma.service";
import { canPerform, type RoleKey } from "@jiangkong/shared-domain";
import { BUSINESS_ENTRY_DEFINITION_REGISTRY } from "../business-entry-definition/business-entry-definition.scene-registry";
import { BusinessEntryCreateTargetService } from "../business-entry-definition/business-entry-create-target.service";
import {
  OperationalWriteFreezeService
} from "../operational-write-freeze/operational-write-freeze.service";
import type {
  AddContractPartyDto,
  BusinessPartyAttachmentCategory,
  BusinessPartyCreateIntentDto,
  BusinessPartySnapshotDto,
  CreateBusinessPartyDto,
  SaveContractDraftPartyDto
} from "./dto/business-party.dto";

const ATTACHMENT_CATEGORIES = new Set<BusinessPartyAttachmentCategory>([
  "business_license",
  "bank_account",
  "legal_id",
  "authorization",
  "qualification",
  "other"
]);

const CONTRACT_PARTY_ROLES = new Set<AddContractPartyDto["roleKey"]>([
  "party_a",
  "party_b",
  "party_c",
  "guarantor",
  "consortium_member",
  "other"
]);

const BUSINESS_PARTY_ACTION = "business_party.create" as const;
const BUSINESS_PARTY_TYPE = "organization" as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function prismaErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

@Injectable()
export class BusinessPartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyRoles: CompanyRoleResolverService = new CompanyRoleResolverService(prisma),
    @Optional() private readonly createTargets: BusinessEntryCreateTargetService = new BusinessEntryCreateTargetService(),
    @Optional() private readonly writeFreeze: OperationalWriteFreezeService = new OperationalWriteFreezeService()
  ) {}

  async assertCanMaintainBusinessEntry(actorUserId: string) {
    await this.assertGlobalContractRole(actorUserId);
  }

  async replaceContractPartiesInTransaction(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    input: SaveContractDraftPartyDto[]
  ) {
    const versionIds = [...new Set(
      input.flatMap((party) =>
        party.businessPartyVersionId ? [party.businessPartyVersionId] : []
      )
    )].sort();
    const versions = versionIds.length
      ? await tx.businessPartyVersion.findMany({
          where: { id: { in: versionIds } }
        })
      : [];
    if (versions.length !== versionIds.length) {
      throw new BadRequestException("合同主体版本不存在，请刷新合作单位后重试");
    }
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const desired = input.map((party) => ({
      roleKey: party.roleKey,
      displayOrder: party.displayOrder,
      businessPartyVersionId: party.businessPartyVersionId ?? null,
      snapshot: party.businessPartyVersionId
        ? JSON.parse(JSON.stringify(
            versionById.get(party.businessPartyVersionId)!.snapshot
          )) as Prisma.InputJsonValue
        : this.copyAggregateSnapshot(party.snapshot)
    }));
    const existing = await tx.contractPartySnapshot.findMany({
      where: { contractVersionId },
      orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
    });
    const key = (party: { roleKey: string; displayOrder: number }) =>
      `${party.roleKey}:${party.displayOrder}`;
    const desiredByKey = new Map(desired.map((party) => [key(party), party]));
    const existingByKey = new Map(existing.map((party) => [key(party), party]));
    const removed = existing.filter((party) => !desiredByKey.has(key(party)));
    const added = desired.filter((party) => !existingByKey.has(key(party)));
    const updated = desired.filter((party) => {
      const current = existingByKey.get(key(party));
      return current !== undefined && (
        current.businessPartyVersionId !== party.businessPartyVersionId ||
        !isDeepStrictEqual(current.snapshot, party.snapshot)
      );
    });
    if (removed.length) {
      await tx.contractPartySnapshot.deleteMany({
        where: { id: { in: removed.map((party) => party.id) } }
      });
    }
    for (const party of updated) {
      await tx.contractPartySnapshot.update({
        where: { id: existingByKey.get(key(party))!.id },
        data: {
          businessPartyVersionId: party.businessPartyVersionId,
          snapshot: party.snapshot
        }
      });
    }
    if (added.length) {
      await tx.contractPartySnapshot.createMany({
        data: added.map((party) => ({
          contractVersionId,
          ...party
        }))
      });
    }
    return {
      changed: removed.length > 0 || added.length > 0 || updated.length > 0
    };
  }

  list(query?: string) {
    const normalizedQuery = query?.trim();
    return this.prisma.businessParty.findMany({
      where: normalizedQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery, mode: "insensitive" } },
              {
                unifiedSocialCreditCode: {
                  contains: normalizedQuery.toUpperCase(),
                  mode: "insensitive"
                }
              }
            ]
          }
        : undefined,
      orderBy: { createdAt: "desc" }
    });
  }

  async get(partyId: string) {
    const party = await this.prisma.businessParty.findUnique({ where: { id: partyId } });
    if (!party) throw new NotFoundException("合作单位不存在");
    const versions = await this.prisma.businessPartyVersion.findMany({
      where: { businessPartyId: partyId },
      orderBy: { versionNo: "desc" }
    });
    return { party, versions };
  }

  async createParty(actorUserId: string, input: CreateBusinessPartyDto) {
    const roleKeys = await this.assertGlobalContractRole(actorUserId);
    const snapshot = this.normalizeSnapshot(input, true);
    return this.createPartyRecord(actorUserId, roleKeys, snapshot);
  }

  async createPartyWithIntent(
    actorUserId: string,
    request: BusinessPartyCreateIntentDto
  ) {
    const definition = BUSINESS_ENTRY_DEFINITION_REGISTRY.getSceneDefinition("business_party");
    if (
      request.definitionKey !== definition.key ||
      request.definitionVersion !== definition.version ||
      !isUuidV4(request.idempotencyKey)
    ) {
      throw new BadRequestException("合作单位创建定义或幂等参数已失效，请刷新后重试");
    }
    const snapshot = this.normalizeSnapshot(request.values, true);
    const fingerprint = this.snapshotFingerprint(snapshot);
    const target = request.target;
    if (
      !target ||
      target.entityType !== "business_party" ||
      typeof target.createTarget !== "string"
    ) {
      throw new BadRequestException("合作单位创建意图无效，请刷新后重试");
    }
    this.createTargets.verify(target.createTarget, {
      actorUserId,
      action: BUSINESS_PARTY_ACTION,
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      definitionKey: definition.key,
      definitionVersion: definition.version,
      idempotencyKey: request.idempotencyKey,
      fingerprint,
      purpose: "submission"
    });

    const existing = await this.findIdempotentResult(request.idempotencyKey, fingerprint);
    const roleKeys = await this.assertGlobalContractRole(actorUserId);
    if (existing) return existing;
    this.writeFreeze.assertCanWrite("master_data");
    return this.createPartyRecord(actorUserId, roleKeys, snapshot, {
      idempotencyKey: request.idempotencyKey,
      fingerprint,
      definitionKey: definition.key,
      definitionVersion: definition.version,
      roleKeys
    });
  }

  private async findIdempotentResult(idempotencyKey: string, fingerprint: string) {
    const idempotency = await this.prisma.businessPartyCreateIdempotency?.findUnique({
      where: { idempotencyKey }
    });
    if (!idempotency) return null;
    if (idempotency.fingerprint !== fingerprint) {
      throw new ConflictException("该幂等键已用于另一份合作单位资料");
    }
    if (!idempotency.businessPartyId || !idempotency.completedAt) return null;
    const party = await this.prisma.businessParty.findUnique({
      where: { id: idempotency.businessPartyId }
    });
    const version = await this.prisma.businessPartyVersion.findFirst({
      where: { businessPartyId: idempotency.businessPartyId, versionNo: 1 }
    });
    if (!party || !version) {
      throw new BadRequestException("合作单位创建结果不完整，请联系管理员");
    }
    return { party, version, replayed: true };
  }

  private async createPartyRecord(
    actorUserId: string,
    roleKeys: readonly RoleKey[],
    snapshot: BusinessPartySnapshotDto,
    idempotency?: {
      idempotencyKey: string;
      fingerprint: string;
      definitionKey: string;
      definitionVersion: number;
      roleKeys: readonly RoleKey[];
    }
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (idempotency) {
          const existing = await tx.businessPartyCreateIdempotency.findUnique({
            where: { idempotencyKey: idempotency.idempotencyKey }
          });
          if (existing) {
            if (existing.fingerprint !== idempotency.fingerprint) {
              throw new ConflictException("该幂等键已用于另一份合作单位资料");
            }
            if (!existing.businessPartyId || !existing.completedAt) {
              throw new ConflictException("该合作单位创建请求正在处理中，请稍后重试");
            }
            const party = await tx.businessParty.findUnique({
              where: { id: existing.businessPartyId }
            });
            const version = await tx.businessPartyVersion.findFirst({
              where: { businessPartyId: existing.businessPartyId, versionNo: 1 }
            });
            if (!party || !version) {
              throw new BadRequestException("合作单位创建结果不完整，请联系管理员");
            }
            return { party, version, replayed: true };
          }
        }

        await this.assertIdentityAvailable(tx, snapshot);
        const party = await tx.businessParty.create({
          data: {
            type: BUSINESS_PARTY_TYPE,
            name: snapshot.name,
            normalizedName: snapshot.name,
            unifiedSocialCreditCode: snapshot.unifiedSocialCreditCode ?? null,
            createdByUserId: actorUserId
          }
        });
        const version = await tx.businessPartyVersion.create({
          data: {
            businessPartyId: party.id,
            versionNo: 1,
            snapshot: this.copySnapshot(snapshot),
            createdByUserId: actorUserId
          }
        });

        if (idempotency) {
          await tx.businessPartyCreateIdempotency.create({
            data: {
              idempotencyKey: idempotency.idempotencyKey,
              actorUserId,
              action: BUSINESS_PARTY_ACTION,
              definitionKey: idempotency.definitionKey,
              definitionVersion: idempotency.definitionVersion,
              fingerprint: idempotency.fingerprint,
              normalizedSnapshot: this.copySnapshot(snapshot),
              businessPartyId: party.id,
              completedAt: new Date()
            }
          });
        }

        await this.audit.record(tx, {
          actorUserId,
          action: BUSINESS_PARTY_ACTION,
          businessType: "business_party",
          businessId: party.id,
          metadata: {
            versionId: version.id,
            versionNo: 1,
            action: BUSINESS_PARTY_ACTION,
            actorRoleKeys: [...roleKeys],
            ...(idempotency
              ? {
                  idempotencyKey: idempotency.idempotencyKey,
                  definitionKey: idempotency.definitionKey,
                  definitionVersion: idempotency.definitionVersion,
                  fingerprint: idempotency.fingerprint,
                  normalizedSnapshot: this.copySnapshot(snapshot)
                }
              : {})
          }
        });
        return { party, version, replayed: false };
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      if (prismaErrorCode(error) === "P2002") {
        if (idempotency) {
          const replay = await this.findIdempotentResult(
            idempotency.idempotencyKey,
            idempotency.fingerprint
          );
          if (replay) return replay;
        }
        throw new ConflictException("合作单位名称或统一社会信用代码已存在，请核对既有档案");
      }
      throw error;
    }
  }

  async createVersion(
    partyId: string,
    actorUserId: string,
    input: CreateBusinessPartyDto
  ) {
    await this.assertGlobalContractRole(actorUserId);
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.businessParty.findUnique({ where: { id: partyId } });
      if (!party) throw new NotFoundException("合作单位不存在");

      const snapshot = this.normalizeSnapshot(input, false);
      await this.assertIdentityAvailable(tx, snapshot, partyId);
      const latestVersion = await tx.businessPartyVersion.findFirst({
        where: { businessPartyId: partyId },
        orderBy: { versionNo: "desc" }
      });
      const versionNo = (latestVersion?.versionNo ?? 0) + 1;
      const version = await tx.businessPartyVersion.create({
        data: {
          businessPartyId: partyId,
          versionNo,
          snapshot: this.copySnapshot(snapshot),
          createdByUserId: actorUserId
        }
      });

      await tx.businessParty.update({
        where: { id: partyId },
        data: {
          name: snapshot.name,
          normalizedName: snapshot.name,
          unifiedSocialCreditCode: snapshot.unifiedSocialCreditCode ?? null
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "business_party.version",
        businessType: "business_party",
        businessId: partyId,
        metadata: { versionId: version.id, versionNo }
      });
      return version;
    });
  }

  async addContractParty(
    contractVersionId: string,
    actorUserId: string,
    input: AddContractPartyDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.assertDraftOwner(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertContractPartyRole(input.roleKey);
      this.assertNotGovernedCompanyRole(input.roleKey);
      const hasVersion = Boolean(input.businessPartyVersionId);
      const hasInlineSnapshot = Boolean(input.snapshot);
      if (hasVersion === hasInlineSnapshot) {
        throw new BadRequestException(
          "合作单位版本和临时快照必须且只能选择一项"
        );
      }

      let snapshot: BusinessPartySnapshotDto;
      if (input.businessPartyVersionId) {
        const version = await tx.businessPartyVersion.findUnique({
          where: { id: input.businessPartyVersionId }
        });
        if (!version) throw new NotFoundException("合作单位版本不存在");
        snapshot = this.normalizeSnapshot(version.snapshot as unknown as BusinessPartySnapshotDto, false);
      } else {
        snapshot = this.normalizeSnapshot(input.snapshot as BusinessPartySnapshotDto, false);
      }
      const newRevision = await this.lockDraftMutation(
        tx,
        version,
        contract,
        actorUserId
      );

      const latest = await tx.contractPartySnapshot.findFirst({
        where: { contractVersionId, roleKey: input.roleKey },
        orderBy: { displayOrder: "desc" }
      });
      const partySnapshot = await tx.contractPartySnapshot.create({
        data: {
          contractVersionId,
          roleKey: input.roleKey,
          displayOrder: (latest?.displayOrder ?? 0) + 1,
          businessPartyVersionId: input.businessPartyVersionId ?? null,
          snapshot: this.copySnapshot(snapshot)
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_party.attach",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          partySnapshotId: partySnapshot.id,
          roleKey: input.roleKey,
          businessPartyVersionId: input.businessPartyVersionId ?? null,
          newRevision
        }
      });
      return partySnapshot;
    });
  }

  async updateContractPartyRole(
    contractVersionId: string,
    partySnapshotId: string,
    actorUserId: string,
    roleKey: AddContractPartyDto["roleKey"]
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.assertDraftOwner(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertContractPartyRole(roleKey);
      this.assertNotGovernedCompanyRole(roleKey);
      const existing = await tx.contractPartySnapshot.findFirst({
        where: { id: partySnapshotId, contractVersionId }
      });
      if (!existing) throw new NotFoundException("合同合作单位快照不存在");
      const newRevision = await this.lockDraftMutation(
        tx,
        version,
        contract,
        actorUserId
      );

      let displayOrder = existing.displayOrder;
      if (existing.roleKey !== roleKey) {
        const latest = await tx.contractPartySnapshot.findFirst({
          where: { contractVersionId, roleKey },
          orderBy: { displayOrder: "desc" }
        });
        displayOrder = (latest?.displayOrder ?? 0) + 1;
      }
      const updated = await tx.contractPartySnapshot.update({
        where: { id: partySnapshotId },
        data: { roleKey, displayOrder }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_party.update_role",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { partySnapshotId, roleKey, displayOrder, newRevision }
      });
      return updated;
    });
  }

  async removeContractParty(
    contractVersionId: string,
    partySnapshotId: string,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.assertDraftOwner(
        tx,
        contractVersionId,
        actorUserId
      );
      const existing = await tx.contractPartySnapshot.findFirst({
        where: { id: partySnapshotId, contractVersionId }
      });
      if (!existing) throw new NotFoundException("合同合作单位快照不存在");
      const newRevision = await this.lockDraftMutation(
        tx,
        version,
        contract,
        actorUserId
      );

      await tx.contractPartySnapshot.delete({ where: { id: partySnapshotId } });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_party.remove_role",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { partySnapshotId, roleKey: existing.roleKey, newRevision }
      });
      return { id: partySnapshotId };
    });
  }

  private normalizeSnapshot(
    input: BusinessPartySnapshotDto,
    serverOwnedAttachments: boolean
  ): BusinessPartySnapshotDto {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException("合作单位信息格式不正确");
    }
    let rawName: unknown;
    let rawCode: unknown;
    let rawAttachments: unknown;
    try {
      const record = input as unknown as Record<string, unknown>;
      rawName = record.name;
      rawCode = record.unifiedSocialCreditCode;
      rawAttachments = record.attachments;
    } catch {
      throw new BadRequestException("合作单位信息格式不正确");
    }
    if (typeof rawName !== "string") {
      throw new BadRequestException("合作单位名称必须是文字");
    }
    const name = this.normalizeName(rawName);
    if (!name) throw new BadRequestException("请填写合作单位名称");
    if (typeof rawCode !== "undefined" && rawCode !== null && typeof rawCode !== "string") {
      throw new BadRequestException("统一社会信用代码必须是文字");
    }
    const codeText = typeof rawCode === "string" ? rawCode.trim() : "";
    const unifiedSocialCreditCode = codeText
      ? assertValidUnifiedSocialCreditCode(codeText)
      : undefined;
    const attachments = serverOwnedAttachments
      ? this.serverOwnedAttachments(rawAttachments)
      : this.normalizeAttachments(rawAttachments);
    const record = input as unknown as Record<string, unknown>;
    const snapshot: BusinessPartySnapshotDto = {
      ...(serverOwnedAttachments ? { type: BUSINESS_PARTY_TYPE } : {}),
      name,
      ...(unifiedSocialCreditCode ? { unifiedSocialCreditCode } : {}),
      ...(!serverOwnedAttachments && typeof record.legalRepresentative === "string"
        ? { legalRepresentative: record.legalRepresentative.trim() }
        : {}),
      ...(!serverOwnedAttachments && typeof record.address === "string"
        ? { address: record.address.trim() }
        : {}),
      ...(!serverOwnedAttachments && typeof record.contactName === "string"
        ? { contactName: record.contactName.trim() }
        : {}),
      ...(!serverOwnedAttachments && typeof record.contactPhone === "string"
        ? { contactPhone: record.contactPhone.trim() }
        : {}),
      attachments
    };
    return snapshot;
  }

  private normalizeName(value: string) {
    const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (Array.from(normalized).length > 100) {
      throw new BadRequestException("合作单位名称不能超过 100 个字符");
    }
    for (const character of normalized) {
      if (/\p{Cc}/u.test(character) && !/\s/u.test(character)) {
        throw new BadRequestException("合作单位名称包含不受支持的控制字符");
      }
    }
    return normalized;
  }

  private serverOwnedAttachments(rawAttachments: unknown) {
    if (rawAttachments !== undefined && !Array.isArray(rawAttachments)) {
      throw new BadRequestException("合作单位附件必须是数组");
    }
    if (Array.isArray(rawAttachments)) this.normalizeAttachments(rawAttachments);
    return [];
  }

  private normalizeAttachments(rawAttachments: unknown) {
    if (!Array.isArray(rawAttachments)) {
      throw new BadRequestException("合作单位附件必须是数组");
    }
    return rawAttachments.map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        throw new BadRequestException("合作单位附件信息不正确");
      }
      const record = attachment as Record<string, unknown>;
      const category = record.category;
      const fileId = record.fileId;
      const attachmentName = record.name;
      if (
        typeof category !== "string" || !ATTACHMENT_CATEGORIES.has(category as BusinessPartyAttachmentCategory) ||
        typeof fileId !== "string" || !fileId.trim() ||
        typeof attachmentName !== "string" || !attachmentName.trim()
      ) {
        throw new BadRequestException("合作单位附件信息不正确");
      }
      return {
        category: category as BusinessPartyAttachmentCategory,
        fileId: fileId.trim(),
        name: attachmentName.trim(),
        ...(typeof record.validUntil === "string" && record.validUntil.trim()
          ? { validUntil: record.validUntil.trim() }
          : {})
      };
    });
  }

  private snapshotFingerprint(snapshot: BusinessPartySnapshotDto) {
    return createHash("sha256").update(stableJson(snapshot)).digest("hex");
  }

  private copySnapshot(snapshot: BusinessPartySnapshotDto): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
  }

  private copyAggregateSnapshot(
    snapshot: Record<string, unknown>
  ): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
  }

  private assertContractPartyRole(roleKey: AddContractPartyDto["roleKey"]) {
    if (!CONTRACT_PARTY_ROLES.has(roleKey)) {
      throw new BadRequestException("合同合作单位角色不正确，请重新选择");
    }
  }

  private assertNotGovernedCompanyRole(roleKey: AddContractPartyDto["roleKey"]) {
    if (roleKey === "party_a") {
      throw new BadRequestException("我方签约主体请回到基本信息从我方公司主体中选择");
    }
  }

  private async assertCreditCodeAvailable(
    tx: Prisma.TransactionClient,
    code?: string,
    excludedPartyId?: string
  ) {
    if (!code) return;
    const duplicate = await tx.businessParty.findUnique({
      where: { unifiedSocialCreditCode: code }
    });
    if (duplicate && duplicate.id !== excludedPartyId) {
      throw new BadRequestException("统一社会信用代码已存在");
    }
  }

  private async assertIdentityAvailable(
    tx: Prisma.TransactionClient,
    snapshot: BusinessPartySnapshotDto,
    excludedPartyId?: string
  ) {
    await this.assertCreditCodeAvailable(
      tx,
      snapshot.unifiedSocialCreditCode,
      excludedPartyId
    );
    const duplicateName = await tx.businessParty.findUnique({
      where: { normalizedName: snapshot.name }
    });
    if (duplicateName && duplicateName.id !== excludedPartyId) {
      throw new ConflictException("合作单位名称已存在，请核对既有档案");
    }
  }

  private async assertGlobalContractRole(actorUserId: string) {
    const roleKeys: RoleKey[] = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform("business_party.create", roleKeys)) {
      throw new ForbiddenException(
        "只有公司级合同人员可以维护合作单位档案"
      );
    }
    return roleKeys;
  }

  private async assertDraftOwner(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const mutationBoundary = await lockContractDraftMutationBoundary(
      tx,
      contractVersionId
    );
    if (!mutationBoundary) {
      throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException(
        "合同已存在正式业务事实，不能变更合作单位"
      );
    }
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
    if (version.contractId !== mutationBoundary.contractId) {
      throw new NotFoundException("合同草稿版本与合同不匹配，请刷新后重试");
    }
    if (version.status !== "draft") {
      throw new BadRequestException("当前合同版本不是草稿状态，不能变更合作单位");
    }
    if (version.changeType === "historical_takeover") {
      throw new BadRequestException(
        "历史接管草稿必须在历史接管工作台办理"
      );
    }
    if (version.changeType === "change" || version.changeType === "supplement") {
      throw new BadRequestException("合同变更不得修改签约主体；如需变更主体请另行办理新合同");
    }
    const contract = await tx.contract.findUnique({
      where: { id: mutationBoundary.contractId }
    });
    if (!contract) throw new NotFoundException("未找到合同草稿，请刷新后重试");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只有合同草稿经办人可以变更合同合作单位");
    }
    if (contract.voidedAt) {
      throw new BadRequestException("合同草稿已作废，不能变更合作单位");
    }
    return { version, contract };
  }

  private async lockDraftMutation(
    tx: Prisma.TransactionClient,
    version: { id: string; draftRevision: number },
    contract: { id: string },
    actorUserId: string
  ) {
    const newRevision = await bumpContractAggregateRevision(
      tx,
      version.id,
      version.draftRevision
    );
    const ownerGate = await tx.contract.updateMany({
      where: {
        id: contract.id,
        ownerUserId: actorUserId,
        voidedAt: null
      },
      data: { ownerUserId: actorUserId }
    });
    if (ownerGate.count !== 1) {
      throw new BadRequestException("合同草稿已变化或当前状态不可编辑，请刷新后重试");
    }
    return newRevision;
  }
}
