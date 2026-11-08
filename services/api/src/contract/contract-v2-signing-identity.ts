import { chinaDateOnly } from "@jiangkong/shared-domain";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Contract-only formalization of an already saved selection; never trusts names as identity. */
export async function freezeInsideContractSigningIdentity(
  tx: Prisma.TransactionClient,
  version: { id: string; draftData: Prisma.JsonValue },
  contract: { projectId: string; companyEntityId: string | null },
  occurredAt: Date
) {
  const draft = object(version.draftData), basics = object(draft.contractBasics), selection = object(draft.companyEntitySelection);
  if (basics.relationship !== "inside") throw new ConflictException("当前合同关系的正式主体冻结尚未就绪，请保留草稿");
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
