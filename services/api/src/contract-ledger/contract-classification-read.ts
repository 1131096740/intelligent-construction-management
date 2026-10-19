import { CONTRACT_RELATIONSHIP_LABELS, downstreamContractRelationship } from "@jiangkong/shared-domain";
import type { PrismaService } from "../database/prisma.service";
/** 批量读取单据冻结的合同版本，不能借用当前合同版本重算历史分类。 */
export async function contractClassifications(prisma: PrismaService, versionIds: readonly (string | null | undefined)[]) {
  const ids = [...new Set(versionIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, string>();
  const versions = await prisma.contractVersion.findMany({ where: { id: { in: ids } }, select: {
    id: true, signingSubjectType: true, companyEntityIdSnapshot: true, companyEntityVersionId: true,
    affiliateAssignmentId: true, affiliateBusinessPartyVersionId: true
  } });
  return new Map(versions.map((v) => [v.id, CONTRACT_RELATIONSHIP_LABELS[downstreamContractRelationship(v)]]));
}
