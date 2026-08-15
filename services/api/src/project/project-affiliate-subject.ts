import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export type ContractSigningSubjectType = "affiliate" | "our_company";

export interface ProjectAffiliateSnapshot {
  assignmentId: string;
  businessPartyId: string;
  businessPartyVersionId: string;
  name: string;
  unifiedSocialCreditCode: string | null;
}

type AffiliateLookupClient = Pick<Prisma.TransactionClient, "projectAffiliateAssignment">;
type ContractSubjectLookupClient = Pick<Prisma.TransactionClient, "contractVersion">;

export async function resolveCurrentProjectAffiliate(
  tx: AffiliateLookupClient,
  projectId: string
): Promise<ProjectAffiliateSnapshot> {
  const assignments = await tx.projectAffiliateAssignment.findMany({
    where: { projectId, endedAt: null },
    select: {
      id: true,
      businessPartyId: true,
      businessPartyVersionId: true,
      affiliateNameSnapshot: true,
      affiliateCreditCodeSnapshot: true
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
    take: 2
  });

  if (assignments.length === 0) {
    throw new BadRequestException(
      "项目尚未明确配置唯一施工企业，不能继续上游或施工企业业务；请先完成项目施工企业人工映射"
    );
  }
  if (assignments.length !== 1) {
    throw new BadRequestException(
      "项目存在多个当前施工企业，不能继续上游或施工企业业务；请先按人工清单消除冲突"
    );
  }

  const assignment = assignments[0]!;
  return {
    assignmentId: assignment.id,
    businessPartyId: assignment.businessPartyId,
    businessPartyVersionId: assignment.businessPartyVersionId,
    name: assignment.affiliateNameSnapshot,
    unifiedSocialCreditCode: assignment.affiliateCreditCodeSnapshot
  };
}

export async function assertContractSigningSubject(
  tx: ContractSubjectLookupClient,
  contractVersionId: string,
  expected: ContractSigningSubjectType
): Promise<void> {
  const version = await tx.contractVersion.findUnique({
    where: { id: contractVersionId },
    select: { signingSubjectType: true }
  });
  if (!version) {
    throw new NotFoundException("合同版本不存在，无法核对签约与付款主体");
  }
  if (version.signingSubjectType !== expected) {
    throw new BadRequestException(
      expected === "our_company"
        ? "该合同冻结为施工企业签约，不能创建或登记我方付款"
        : "该合同冻结为我方签约，不能登记施工企业付款"
    );
  }
}
