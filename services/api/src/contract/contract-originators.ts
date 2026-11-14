import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const SOURCE_REVIEW_MESSAGE = "合同创建来源尚未核实，请联系合同主管核实后再提交或审批";

/** Creation provenance is immutable audit evidence; current ownership is transferable. */
export async function resolveContractOriginators(
  tx: Prisma.TransactionClient,
  versionId: string,
  frozenNodes?: unknown
): Promise<string[]> {
  const nodes = Array.isArray(frozenNodes) ? frozenNodes : [];
  const frozen = nodes.map(node => node && typeof node === "object" ? (node as { originatorUserIds?: unknown }).originatorUserIds : undefined);
  if (frozen.some(value => value !== undefined)) {
    if (!frozen.length || !frozen.every(value => Array.isArray(value) && value.length > 0 && value.every(id => typeof id === "string" && id.length > 0) && new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(frozen[0]))) {
      throw new ConflictException(SOURCE_REVIEW_MESSAGE);
    }
    return frozen[0] as string[];
  }
  const sources = await tx.$queryRaw<Array<{ actorUserId: string | null }>>(Prisma.sql`
    SELECT a."actorUserId"
    FROM "ContractVersion" v JOIN "AuditLog" a ON
      (v."baseVersionId" IS NOT NULL AND a."businessType" = 'contract_version'
        AND a."businessId" = v."id" AND a."action" = 'contract.change_draft.create')
      OR (v."baseVersionId" IS NULL AND a."businessType" = 'contract'
        AND a."businessId" = v."contractId" AND a."action" IN ('contract.draft.create', 'contract.draft.copy'))
    WHERE v."id" = ${versionId}
    ORDER BY a."id"
  `);
  if (!Array.isArray(sources) || sources.length !== 1 || !sources[0]?.actorUserId) {
    throw new ConflictException(SOURCE_REVIEW_MESSAGE);
  }
  return [sources[0].actorUserId];
}
