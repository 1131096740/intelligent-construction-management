import { chinaDateOnly } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";

export async function readUpwardPendingSubjects(
  tx: Prisma.TransactionClient, projectId: string, contractVersionId: string, draftRevision: number, now: Date
) {
  const businessDay = new Date(chinaDateOnly(now) + "T00:00:00.000Z");
  const [project, assignments] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { isActive: true } }),
    tx.projectAffiliateAssignment.findMany({ where: {
      projectId, effectiveFrom: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }]
    } })
  ]);
  if (!project?.isActive) return undefined;
  const empty = { projectId, contractVersionId, draftRevision, enterprise: null, companies: [] };
  if (assignments.length !== 1) return empty;
  const [assignment] = assignments;
  const [enterprise, enterpriseVersion, participations] = await Promise.all([
    tx.businessParty.findUnique({ where: { id: assignment.businessPartyId } }),
    tx.businessPartyVersion.findUnique({ where: { id: assignment.businessPartyVersionId } }),
    tx.projectParticipatingCompany.findMany({ where: {
      projectId, effectiveFrom: { lte: businessDay }, OR: [{ endedAt: null }, { endedAt: { gt: businessDay } }]
    } })
  ]);
  const enterpriseCreditCode = assignment.affiliateCreditCodeSnapshot?.trim().toUpperCase();
  if (enterprise?.status !== "active" || enterpriseVersion?.businessPartyId !== enterprise.id ||
    !assignment.affiliateNameSnapshot.trim() || !enterpriseCreditCode) return empty;
  const participationByCompany = new Map<string, typeof participations[number] | null>();
  for (const participation of participations) {
    const companyId = participation.companyEntityId;
    participationByCompany.set(companyId, participationByCompany.has(companyId) ? null : participation);
  }
  const companies = await tx.companyEntity.findMany({ where: {
    id: { in: [...participationByCompany.keys()] }, isActive: true, dataStatus: "complete"
  }, orderBy: { id: "asc" } });
  const eligibleCompanies = [];
  for (const company of companies) {
    const participation = participationByCompany.get(company.id);
    if (!participation) continue;
    const [current, joined] = await Promise.all([
      tx.companyEntityVersion.findUnique({ where: { companyEntityId_versionNo: { companyEntityId: company.id, versionNo: company.currentVersionNo } } }),
      tx.companyEntityVersion.findUnique({ where: { id: participation.companyEntityVersionId } })
    ]);
    const creditCode = current?.unifiedSocialCreditCode?.trim().toUpperCase();
    if (!current?.isActive || !current.name.trim() || !creditCode || creditCode === enterpriseCreditCode || joined?.companyEntityId !== company.id) continue;
    eligibleCompanies.push({ companyEntityId: company.id, companyEntityVersionId: current.id, name: current.name });
  }
  return { ...empty, enterprise: { businessPartyVersionId: enterpriseVersion.id, name: assignment.affiliateNameSnapshot }, companies: eligibleCompanies };
}
