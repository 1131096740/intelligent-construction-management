import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { AuditService } from "../audit/audit.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { bumpContractAggregateRevision } from "../contract-workbench/contract-render-input-revision";
import { PrismaService } from "../database/prisma.service";
import type {
  AddContractPartyDto,
  BusinessPartyAttachmentCategory,
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

@Injectable()
export class BusinessPartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async assertCanMaintainBusinessEntry(actorUserId: string) {
    await this.assertGlobalContractRole(
      this.prisma as unknown as Prisma.TransactionClient,
      actorUserId
    );
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalContractRole(tx, actorUserId);
      const snapshot = this.normalizeSnapshot(input);
      await this.assertCreditCodeAvailable(tx, snapshot.unifiedSocialCreditCode);

      const party = await tx.businessParty.create({
        data: {
          name: snapshot.name,
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

      await this.audit.record(tx, {
        actorUserId,
        action: "business_party.create",
        businessType: "business_party",
        businessId: party.id,
        metadata: { versionId: version.id, versionNo: 1 }
      });
      return { party, version };
    });
  }

  async createVersion(
    partyId: string,
    actorUserId: string,
    input: CreateBusinessPartyDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalContractRole(tx, actorUserId);
      const party = await tx.businessParty.findUnique({ where: { id: partyId } });
      if (!party) throw new NotFoundException("合作单位不存在");

      const snapshot = this.normalizeSnapshot(input);
      await this.assertCreditCodeAvailable(
        tx,
        snapshot.unifiedSocialCreditCode,
        partyId
      );
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
        snapshot = this.normalizeSnapshot(version.snapshot as unknown as BusinessPartySnapshotDto);
      } else {
        snapshot = this.normalizeSnapshot(input.snapshot as BusinessPartySnapshotDto);
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

  private normalizeSnapshot(input: BusinessPartySnapshotDto): BusinessPartySnapshotDto {
    const name = input?.name?.trim();
    if (!name) throw new BadRequestException("请填写合作单位名称");
    if (!Array.isArray(input.attachments)) {
      throw new BadRequestException("合作单位附件必须是数组");
    }
    const attachments = input.attachments.map((attachment) => {
      if (
        !ATTACHMENT_CATEGORIES.has(attachment.category) ||
        !attachment.fileId?.trim() ||
        !attachment.name?.trim()
      ) {
        throw new BadRequestException("合作单位附件信息不正确");
      }
      return {
        ...attachment,
        fileId: attachment.fileId.trim(),
        name: attachment.name.trim()
      };
    });
    const unifiedSocialCreditCode = input.unifiedSocialCreditCode?.trim().toUpperCase();
    return {
      ...input,
      name,
      unifiedSocialCreditCode: unifiedSocialCreditCode || undefined,
      attachments
    };
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

  private async assertGlobalContractRole(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (
      !positions.some(
        (position) =>
          position.key === "contract_staff" || position.key === "contract_director"
      )
    ) {
      throw new ForbiddenException(
        "只有公司级合同人员可以维护合作单位档案"
      );
    }
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
