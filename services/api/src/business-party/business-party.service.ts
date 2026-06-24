import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type {
  AddContractPartyDto,
  BusinessPartyAttachmentCategory,
  BusinessPartySnapshotDto,
  CreateBusinessPartyDto
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
    if (!party) throw new NotFoundException("Business party not found");
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
      if (!party) throw new NotFoundException("Business party not found");

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
      await this.assertDraftOwner(tx, contractVersionId, actorUserId);
      this.assertContractPartyRole(input.roleKey);
      const hasVersion = Boolean(input.businessPartyVersionId);
      const hasInlineSnapshot = Boolean(input.snapshot);
      if (hasVersion === hasInlineSnapshot) {
        throw new BadRequestException(
          "Provide exactly one of businessPartyVersionId or snapshot"
        );
      }

      let snapshot: BusinessPartySnapshotDto;
      if (input.businessPartyVersionId) {
        const version = await tx.businessPartyVersion.findUnique({
          where: { id: input.businessPartyVersionId }
        });
        if (!version) throw new NotFoundException("Business party version not found");
        snapshot = this.normalizeSnapshot(version.snapshot as unknown as BusinessPartySnapshotDto);
      } else {
        snapshot = this.normalizeSnapshot(input.snapshot as BusinessPartySnapshotDto);
      }

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
          businessPartyVersionId: input.businessPartyVersionId ?? null
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
      await this.assertDraftOwner(tx, contractVersionId, actorUserId);
      this.assertContractPartyRole(roleKey);
      const existing = await tx.contractPartySnapshot.findFirst({
        where: { id: partySnapshotId, contractVersionId }
      });
      if (!existing) throw new NotFoundException("Contract party snapshot not found");

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
        metadata: { partySnapshotId, roleKey, displayOrder }
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
      await this.assertDraftOwner(tx, contractVersionId, actorUserId);
      const approvalInstance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: contractVersionId
        }
      });
      if (approvalInstance) {
        throw new BadRequestException(
          "Contract party snapshots cannot be removed after approval submission"
        );
      }
      const existing = await tx.contractPartySnapshot.findFirst({
        where: { id: partySnapshotId, contractVersionId }
      });
      if (!existing) throw new NotFoundException("Contract party snapshot not found");

      await tx.contractPartySnapshot.delete({ where: { id: partySnapshotId } });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_party.remove_role",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { partySnapshotId, roleKey: existing.roleKey }
      });
      return { id: partySnapshotId };
    });
  }

  private normalizeSnapshot(input: BusinessPartySnapshotDto): BusinessPartySnapshotDto {
    const name = input?.name?.trim();
    if (!name) throw new BadRequestException("Business party name is required");
    if (!Array.isArray(input.attachments)) {
      throw new BadRequestException("Business party attachments must be an array");
    }
    const attachments = input.attachments.map((attachment) => {
      if (
        !ATTACHMENT_CATEGORIES.has(attachment.category) ||
        !attachment.fileId?.trim() ||
        !attachment.name?.trim()
      ) {
        throw new BadRequestException("Invalid business party attachment");
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

  private assertContractPartyRole(roleKey: AddContractPartyDto["roleKey"]) {
    if (!CONTRACT_PARTY_ROLES.has(roleKey)) {
      throw new BadRequestException("Invalid contract party role");
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
      throw new BadRequestException("Unified social credit code already exists");
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
        "Requires global role: contract_staff or contract_director"
      );
    }
  }

  private async assertDraftOwner(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) throw new NotFoundException("Contract version not found");
    if (version.status !== "draft") {
      throw new BadRequestException("Contract parties can only be changed in draft status");
    }
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("Contract not found");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Only the draft owner can change contract parties");
    }
  }
}
