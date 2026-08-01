import { ConflictException } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

export interface ProjectFinancingQuotaApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
}

export interface FinancingQuotaApprovalInstanceSnapshot {
  id: string;
  businessId: string;
  applicantUserId: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectFinancingQuotaApprovalSubject {
  id: string;
  requestedByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  status: string;
}

export const PROJECT_FINANCING_QUOTA_APPROVAL_NODES: ProjectFinancingQuotaApprovalNode[] = [
  { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
];

export function indexProjectFinancingQuotaApprovalInstances(
  instances: FinancingQuotaApprovalInstanceSnapshot[]
) {
  const byBusinessId = new Map<string, FinancingQuotaApprovalInstanceSnapshot>();
  for (const instance of instances) {
    if (byBusinessId.has(instance.businessId)) {
      throw new ConflictException("项目垫资额度存在重复的生命周期审批实例");
    }
    byBusinessId.set(instance.businessId, instance);
  }
  return byBusinessId;
}

export function assertProjectFinancingQuotaApprovalLifecycle(
  quota: ProjectFinancingQuotaApprovalSubject,
  instance: FinancingQuotaApprovalInstanceSnapshot | undefined
): {
  instance: FinancingQuotaApprovalInstanceSnapshot;
  nodes: ProjectFinancingQuotaApprovalNode[];
} {
  if (!instance) {
    throw new ConflictException("项目垫资额度缺少生命周期审批实例");
  }
  const shouldHaveApprovalFacts =
    quota.status === "approved" || quota.status === "terminated";
  const hasApprovedBy =
    typeof quota.approvedByUserId === "string" &&
    quota.approvedByUserId.trim().length > 0;
  const hasApprovedAt =
    quota.approvedAt instanceof Date &&
    !Number.isNaN(quota.approvedAt.getTime());
  if (
    hasApprovedBy !== shouldHaveApprovalFacts ||
    hasApprovedAt !== shouldHaveApprovalFacts
  ) {
    throw new ConflictException("项目垫资额度审批终态事实不完整");
  }
  return {
    instance,
    nodes: assertProjectFinancingQuotaApprovalSnapshot(
      instance,
      quota.requestedByUserId,
      quota.status
    )
  };
}

export function assertProjectFinancingQuotaApprovalSnapshot(
  instance: FinancingQuotaApprovalInstanceSnapshot,
  requestedByUserId: string,
  quotaStatus: string
): ProjectFinancingQuotaApprovalNode[] {
  if (instance.applicantUserId !== requestedByUserId) {
    throw new ConflictException("项目垫资额度申请人与审批实例申请人不一致");
  }
  const nodes = readProjectFinancingQuotaApprovalNodes(instance.frozenNodes);
  const expectedRoleKeys: RoleKey[][] = [
    ["finance_director"],
    ["chairman", "general_manager"]
  ];
  const expectedInstanceStatus =
    quotaStatus === "approval_pending"
      ? "in_progress"
      : quotaStatus === "rejected"
        ? "rejected"
        : quotaStatus === "approved" || quotaStatus === "terminated"
          ? "approved"
          : null;
  const terminalApproved = expectedInstanceStatus === "approved";
  if (
    !expectedInstanceStatus ||
    instance.status !== expectedInstanceStatus ||
    !Number.isInteger(instance.currentNodeIndex) ||
    (terminalApproved
      ? instance.currentNodeIndex !== expectedRoleKeys.length
      : instance.currentNodeIndex < 0 ||
        instance.currentNodeIndex >= expectedRoleKeys.length) ||
    nodes.length !== expectedRoleKeys.length ||
    nodes.some((node, index) =>
      node.name !== PROJECT_FINANCING_QUOTA_APPROVAL_NODES[index]?.name ||
      node.mode !== "any" ||
      !sameOrderedRoleKeys(node.roleKeys, expectedRoleKeys[index] ?? []) ||
      (node.approvedRoleKeys ?? []).length !==
        (terminalApproved || index < instance.currentNodeIndex ? 1 : 0) ||
      (node.approvedRoleKeys ?? []).some((roleKey) =>
        !node.roleKeys.includes(roleKey)
      )
    )
  ) {
    throw new ConflictException("项目垫资额度冻结审批链与既定流程不一致");
  }
  return nodes;
}

function readProjectFinancingQuotaApprovalNodes(
  value: unknown
): ProjectFinancingQuotaApprovalNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: ProjectFinancingQuotaApprovalNode[] = [];
  for (const rawNode of value) {
    if (!rawNode || typeof rawNode !== "object") return [];
    const node = rawNode as Record<string, unknown>;
    if (
      typeof node.name !== "string" ||
      node.name.trim().length === 0 ||
      node.mode !== "any" ||
      !Array.isArray(node.roleKeys) ||
      !node.roleKeys.length ||
      node.roleKeys.some((roleKey) => typeof roleKey !== "string") ||
      (node.approvedRoleKeys !== undefined &&
        (!Array.isArray(node.approvedRoleKeys) ||
          node.approvedRoleKeys.some((roleKey) => typeof roleKey !== "string")))
    ) {
      return [];
    }
    nodes.push({
      name: node.name,
      mode: "any",
      roleKeys: node.roleKeys as RoleKey[],
      approvedRoleKeys: Array.isArray(node.approvedRoleKeys)
        ? node.approvedRoleKeys as RoleKey[]
        : undefined
    });
  }
  return nodes;
}

function sameOrderedRoleKeys(actual: RoleKey[], expected: RoleKey[]) {
  return actual.length === expected.length &&
    actual.every((roleKey, index) => roleKey === expected[index]);
}
