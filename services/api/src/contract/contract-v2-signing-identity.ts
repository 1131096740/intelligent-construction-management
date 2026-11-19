import { chinaDateOnly } from "@jiangkong/shared-domain";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma, type Contract, type ContractPartySnapshot, type ContractVersion } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { qualifyGeneratedUpwardSubmission } from "./contract-upward-pending-save-profile";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Formalize the already saved parties and their positions in the current generated document. */
export async function freezeGeneratedContractSigningIdentity(
  tx: Prisma.TransactionClient,
  version: ContractVersion,
  contract: Contract,
  parties: ContractPartySnapshot[],
  documentInput: Prisma.JsonValue,
  occurredAt: Date
) {
  const relationship = object(object(version.draftData).contractBasics).relationship;
  if (relationship === "inside") return { ...await freezeInsideContractSigningIdentity(tx, version, contract, occurredAt), upward: null };
  if (relationship === "outside") return { ...await freezeOutsideContractSigningIdentity(tx, version, contract, parties, occurredAt), upward: null };
  if (relationship === "upward") return prepareUpwardGeneratedSigningIdentity(tx, version, contract, parties, documentInput, occurredAt);
  throw new ConflictException("当前合同关系的正式主体冻结尚未就绪，请保留草稿");
}

async function prepareUpwardGeneratedSigningIdentity(
  tx: Prisma.TransactionClient,
  version: ContractVersion,
  contract: Contract,
  parties: ContractPartySnapshot[],
  documentInput: Prisma.JsonValue,
  occurredAt: Date
) {
  const selection = object(object(version.draftData).companyEntitySelection);
  const companyId = contract.companyEntityId;
  const enterpriseSlots = parties.filter(party => party.roleKey === "party_b");
  const [enterpriseParty] = enterpriseSlots;
  if (version.versionNo !== 1 || version.baseVersionId != null || version.supersedesVersionId != null
    || version.copiedFromContractVersionId != null || version.effectiveAt != null || version.endedAt != null
    || !["draft_unconfirmed", "upward"].includes(version.signingSubjectType)
    || (version.signingSubjectType === "upward") !== Boolean(version.firstSubmittedAt)
    || !companyId || selection.id !== companyId || typeof selection.versionId !== "string"
    || parties.some(party => party.roleKey === "party_a")
    || enterpriseSlots.length !== 1 || !enterpriseParty?.businessPartyVersionId || enterpriseParty.displayOrder !== 0) {
    throw new ConflictException("请核对对上合同正文的我方公司甲方与施工企业乙方");
  }

  const stored = await tx.$queryRaw<Array<{ id: string; originalSignedNumber: string | null }>>(Prisma.sql`
    SELECT "id", "originalSignedNumber" FROM public."ContractVersion" WHERE "id" = ${version.id} AND "contractId" = ${contract.id}
  `);
  if (stored.length !== 1 || stored[0].id !== version.id || stored[0].originalSignedNumber !== null) {
    throw new ConflictException("对上生成合同不能带有原签合同编号");
  }

  const projects = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
    SELECT "id", "isActive" FROM "Project" WHERE "id" = ${contract.projectId} FOR UPDATE
  `);
  if (projects.length !== 1 || projects[0].id !== contract.projectId || projects[0].isActive !== true) {
    throw new ConflictException("项目当前不可提交合同");
  }
  const assignments = await tx.projectAffiliateAssignment.findMany({ where: {
    projectId: contract.projectId, effectiveFrom: { lte: occurredAt },
    OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
  } });
  const [assignment] = assignments;
  if (assignments.length !== 1 || !assignment || assignment.businessPartyVersionId !== enterpriseParty.businessPartyVersionId) {
    throw new ConflictException("施工企业乙方须与本项目当前有效派驻版本一致");
  }
  const enterprise = await tx.businessPartyVersion.findUnique({ where: { id: assignment.businessPartyVersionId } });
  const enterpriseSnapshot = object(enterprise?.snapshot);
  const enterpriseName = typeof enterpriseSnapshot.name === "string" ? enterpriseSnapshot.name.trim() : "";
  const enterpriseCredit = typeof enterpriseSnapshot.unifiedSocialCreditCode === "string" ? enterpriseSnapshot.unifiedSocialCreditCode.trim() : "";
  const enterpriseParents = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    SELECT "id", "status" FROM "BusinessParty" WHERE "id" IN (${Prisma.join([assignment.businessPartyId])}) ORDER BY "id" FOR UPDATE
  `);
  if (!enterprise || enterprise.businessPartyId !== assignment.businessPartyId || enterpriseParents.length !== 1
    || enterpriseParents[0].id !== assignment.businessPartyId || enterpriseParents[0].status !== "active"
    || !enterpriseName || !isDeepStrictEqual(enterprise.snapshot, enterpriseParty.snapshot)
    || assignment.affiliateNameSnapshot !== enterpriseName || assignment.affiliateCreditCodeSnapshot !== (enterpriseCredit || null)) {
    throw new ConflictException("施工企业派驻与正文乙方资料不一致");
  }

  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CompanyEntity" WHERE "id" = ${companyId} FOR UPDATE`);
  const entity = await tx.companyEntity.findUnique({ where: { id: companyId } });
  if (!entity?.isActive || entity.dataStatus !== "complete" || entity.currentVersionNo !== selection.versionNo) {
    throw new ConflictException("所选我方公司版本已变化，请重新核对并同步正文");
  }
  const company = await tx.companyEntityVersion.findUnique({ where: { companyEntityId_versionNo: { companyEntityId: companyId, versionNo: entity.currentVersionNo } } });
  if (!company?.isActive || !company.unifiedSocialCreditCode?.trim()
    || company.id !== selection.versionId || company.name !== selection.name
    || company.unifiedSocialCreditCode !== selection.unifiedSocialCreditCode || company.registeredAddress !== selection.registeredAddress
    || (enterpriseCredit
      ? company.unifiedSocialCreditCode.trim().toUpperCase() === enterpriseCredit.toUpperCase()
      : company.name.normalize("NFKC").trim().toLowerCase() === enterpriseName.normalize("NFKC").toLowerCase())) {
    throw new ConflictException("我方公司甲方资料已变化或与施工企业为同一主体");
  }
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProjectParticipatingCompany" WHERE "projectId" = ${contract.projectId} AND "companyEntityId" = ${companyId} ORDER BY "id" FOR SHARE`);
  const businessDay = chinaDateOnly(occurredAt);
  const day = new Date(`${businessDay}T00:00:00.000Z`);
  const participants = await tx.projectParticipatingCompany.findMany({ where: {
    projectId: contract.projectId, companyEntityId: companyId, effectiveFrom: { lte: day },
    OR: [{ endedAt: null }, { endedAt: { gt: day } }]
  } });
  const [participant] = participants;
  const joined = participants.length === 1 && participant
    ? await tx.companyEntityVersion.findUnique({ where: { id: participant.companyEntityVersionId } })
    : null;
  if (!participant || !joined || joined.companyEntityId !== companyId
    || joined.name !== participant.companyNameSnapshot || joined.unifiedSocialCreditCode !== participant.companyCreditCodeSnapshot) {
    throw new ConflictException("本项目缺少我方公司的有效参与版本");
  }

  const values = object(object(object(documentInput).renderInput).values);
  const matchesPaperSlot = (keys: string[], expected: Record<string, unknown>) => keys.every(key =>
    isDeepStrictEqual(values[key], [expected]) &&
    Object.entries(expected).every(([field, value]) => isDeepStrictEqual(values[`${key}.${field}`], value)));
  if (!matchesPaperSlot(["party.party_a", "party.owner"], selection) ||
    !matchesPaperSlot(["party.party_b", "party.counterparty"], enterpriseSnapshot)) {
    throw new ConflictException("当前生成文书的甲乙方依据与正文不一致，请重新生成");
  }

  const qualification = await qualifyGeneratedUpwardSubmission(tx);
  const subjectUpdate = {
    signingSubjectType: "upward",
    companyEntityIdSnapshot: companyId, companyEntityVersionId: company.id,
    companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: company.unifiedSocialCreditCode,
    companyEntityRegisteredAddressSnapshot: company.registeredAddress,
    affiliateAssignmentId: assignment.id, affiliateBusinessPartyVersionId: enterprise.id,
    affiliateNameSnapshot: enterpriseName, affiliateCreditCodeSnapshot: enterpriseCredit || null
  };
  return {
    formalVersion: { ...version, ...subjectUpdate }, upward: { subjectUpdate, qualification },
    identity: { protocolVersion: 1, relationship: "upward", roleSource: "document_company_selection_party_a_and_assignment_party_b",
      businessDay, occurredAt: occurredAt.toISOString(),
      company: { domain: "company_entity_version", id: company.id, companyEntityId: companyId, roleKey: "party_a", displayOrder: 0,
        projectParticipatingCompanyId: participant.id, joinedCompanyEntityVersionId: joined.id },
      enterprise: { domain: "project_affiliate_assignment", assignmentId: assignment.id, businessPartyId: enterprise.businessPartyId,
        businessPartyVersionId: enterprise.id, roleKey: "party_b", displayOrder: 0, partySnapshotId: enterpriseParty.id,
        effectiveFrom: assignment.effectiveFrom.toISOString() }
    }
  };
}

async function freezeInsideContractSigningIdentity(
  tx: Prisma.TransactionClient,
  version: { id: string; draftData: Prisma.JsonValue },
  contract: { projectId: string; companyEntityId: string | null },
  occurredAt: Date
) {
  const selection = object(object(version.draftData).companyEntitySelection);
  // The existing document producer explicitly binds structured company selection
  // to party.party_a / party.owner, overriding legacy CPS party_a. This branch
  // consumes that existing semantic source, never a caller-supplied role.
  const role = "party_a";
  if (typeof selection.id !== "string" || selection.id !== contract.companyEntityId || typeof selection.versionId !== "string" || !Number.isInteger(selection.versionNo)) {
    throw new BadRequestException("我方公司主体选择尚未同步，请重新选择并保存");
  }
  const selectedId = selection.id;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CompanyEntity" WHERE "id" = ${selectedId} FOR UPDATE`);
  const entity = await tx.companyEntity.findUnique({ where: { id: selectedId } });
  if (!entity?.isActive || entity.dataStatus !== "complete" || entity.currentVersionNo !== selection.versionNo) throw new ConflictException("所选我方公司状态或版本已变化，请重新核对并同步正文");
  const company = await tx.companyEntityVersion.findUnique({ where: { companyEntityId_versionNo: { companyEntityId: selectedId, versionNo: entity.currentVersionNo } } });
  if (!company || !company.unifiedSocialCreditCode || company.id !== selection.versionId || company.name !== selection.name || company.unifiedSocialCreditCode !== selection.unifiedSocialCreditCode || company.registeredAddress !== selection.registeredAddress) throw new ConflictException("所选我方公司资料已变化，请重新保存并同步正文");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProjectParticipatingCompany" WHERE "projectId" = ${contract.projectId} AND "companyEntityId" = ${selectedId} ORDER BY "id" FOR SHARE`);
  const businessDay = chinaDateOnly(occurredAt);
  const participantDate = new Date(`${businessDay}T00:00:00.000Z`);
  const participants = await tx.projectParticipatingCompany.findMany({ where: { projectId: contract.projectId, companyEntityId: selectedId, effectiveFrom: { lte: participantDate }, OR: [{ endedAt: null }, { endedAt: { gt: participantDate } }] } });
  if (participants.length !== 1) throw new BadRequestException("所选我方公司在提交日期缺少唯一有效项目参与关系，请先核对项目主体");
  const formalVersion = await tx.contractVersion.update({ where: { id: version.id }, data: {
    signingSubjectType: "our_company", companyEntityIdSnapshot: company.companyEntityId, companyEntityVersionId: company.id,
    companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: company.unifiedSocialCreditCode, companyEntityRegisteredAddressSnapshot: company.registeredAddress,
    affiliateAssignmentId: null, affiliateBusinessPartyVersionId: null, affiliateNameSnapshot: null, affiliateCreditCodeSnapshot: null
  } });
  return { formalVersion, identity: { protocolVersion: 1, relationship: "inside", roleSource: "document_company_selection_party_a", businessDay, occurredAt: occurredAt.toISOString(),
    company: { domain: "company_entity_version", id: company.id, companyEntityId: company.companyEntityId, roleKey: role, displayOrder: 0, projectParticipatingCompanyId: participants[0].id } } };
}

async function freezeOutsideContractSigningIdentity(
  tx: Prisma.TransactionClient,
  version: ContractVersion,
  contract: Contract,
  parties: ContractPartySnapshot[],
  occurredAt: Date
) {
  const companySelection = object(object(version.draftData).companyEntitySelection);
  if (contract.companyEntityId || version.companyEntityNameSnapshot || typeof companySelection.name === "string") {
    throw new ConflictException("表外合同正文仍绑定我方公司，请核对当前甲乙方");
  }
  const namedSides = parties.filter(party => party.roleKey === "party_a" || party.roleKey === "party_b");
  const partyA = namedSides.find(party => party.roleKey === "party_a");
  const partyB = namedSides.find(party => party.roleKey === "party_b");
  if (namedSides.length !== 2 || !partyA || !partyB || partyA.displayOrder !== 0 || partyB.displayOrder !== 0) {
    throw new BadRequestException("请分别核对正文中的甲方与乙方");
  }

  // Project assignment writers take this same lock before changing the project's enterprise.
  const [project] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
    SELECT "id", "isActive" FROM "Project" WHERE "id" = ${contract.projectId} FOR UPDATE
  `);
  if (!project?.isActive) throw new ConflictException("项目当前不可提交合同");
  const assignments = await tx.projectAffiliateAssignment.findMany({ where: {
    projectId: contract.projectId, effectiveFrom: { lte: occurredAt },
    OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
  } });
  const [assignment] = assignments;
  if (assignments.length !== 1 || !assignment) throw new ConflictException("本项目缺少唯一有效的施工企业派驻，请先核对");
  const enterpriseSides = namedSides.filter(party => party.businessPartyVersionId === assignment.businessPartyVersionId);
  const [enterpriseParty] = enterpriseSides;
  if (enterpriseSides.length !== 1 || !enterpriseParty) throw new ConflictException("正文签约施工企业不是本项目当前派驻版本，请重新核对并同步正文");
  const enterprise = await tx.businessPartyVersion.findUnique({ where: { id: assignment.businessPartyVersionId } });
  const enterpriseSnapshot = object(enterprise?.snapshot);
  const enterpriseName = typeof enterpriseSnapshot.name === "string" ? enterpriseSnapshot.name.trim() : "";
  const enterpriseCredit = typeof enterpriseSnapshot.unifiedSocialCreditCode === "string" ? enterpriseSnapshot.unifiedSocialCreditCode.trim() || null : null;
  if (!enterprise || enterprise.businessPartyId !== assignment.businessPartyId
    || !isDeepStrictEqual(enterprise.snapshot, enterpriseParty.snapshot)
    || !enterpriseName || assignment.affiliateNameSnapshot !== enterpriseName
    || assignment.affiliateCreditCodeSnapshot !== enterpriseCredit) {
    throw new ConflictException("施工企业派驻与正文冻结资料不一致，请重新核对并同步正文");
  }

  const downstreamParty = enterpriseParty === partyA ? partyB : partyA;
  const downstream = downstreamParty.businessPartyVersionId
    ? await tx.businessPartyVersion.findUnique({ where: { id: downstreamParty.businessPartyVersionId } })
    : null;
  const downstreamSnapshot = object(downstreamParty.snapshot);
  const downstreamName = typeof downstreamSnapshot.name === "string" ? downstreamSnapshot.name.trim() : "";
  const downstreamCredit = typeof downstreamSnapshot.unifiedSocialCreditCode === "string" ? downstreamSnapshot.unifiedSocialCreditCode.trim() : "";
  if (!downstreamName || downstreamParty.businessPartyVersionId && (!downstream || !isDeepStrictEqual(downstream.snapshot, downstreamParty.snapshot))
    || downstream?.businessPartyId === enterprise.businessPartyId
    || enterpriseCredit && downstreamCredit.toUpperCase() === enterpriseCredit.toUpperCase()
    || !downstream && downstreamName === enterpriseName) {
    throw new ConflictException("表外合同须有与施工企业不同的下游单位，请核对正文双方");
  }
  const formalVersion = await tx.contractVersion.update({ where: { id: version.id }, data: {
    signingSubjectType: "affiliate", companyEntityIdSnapshot: null, companyEntityVersionId: null,
    companyEntityNameSnapshot: null, companyEntityCreditCodeSnapshot: null, companyEntityRegisteredAddressSnapshot: null,
    affiliateAssignmentId: assignment.id, affiliateBusinessPartyVersionId: enterprise.id,
    affiliateNameSnapshot: enterpriseName, affiliateCreditCodeSnapshot: enterpriseCredit
  } });
  return { formalVersion, identity: { protocolVersion: 1, relationship: "outside", roleSource: "document_party_snapshots",
    businessDay: chinaDateOnly(occurredAt), occurredAt: occurredAt.toISOString(),
    enterprise: { domain: "project_affiliate_assignment", assignmentId: assignment.id, businessPartyId: enterprise.businessPartyId,
      businessPartyVersionId: enterprise.id, roleKey: enterpriseParty.roleKey, displayOrder: enterpriseParty.displayOrder,
      partySnapshotId: enterpriseParty.id, effectiveFrom: assignment.effectiveFrom.toISOString() },
    downstream: { domain: downstream ? "business_party_version" : "contract_party_snapshot",
      businessPartyId: downstream?.businessPartyId ?? null, businessPartyVersionId: downstream?.id ?? null,
      roleKey: downstreamParty.roleKey, displayOrder: downstreamParty.displayOrder, partySnapshotId: downstreamParty.id } } };
}
