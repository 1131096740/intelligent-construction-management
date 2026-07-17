export type GovernedSettlementContractTypeKey =
  | "material_purchase"
  | "equipment_rental"
  | "labor_subcontract"
  | "professional_subcontract";

export type SettlementFieldReviewerRoleKey =
  | "material_staff"
  | "engineering_foreman"
  | "engineering_tech";

export interface SettlementProjectMemberSnapshot {
  projectId: string;
  userId: string;
  roleKey: string;
  userIsActive: boolean;
}

export interface FreezeSettlementParticipantsInput {
  contractTypeKey: string | null;
  projectId: string;
  selectedUserId: string | null;
  projectMembers: SettlementProjectMemberSnapshot[];
}

export interface FrozenSettlementParticipants {
  fieldReviewerUserId: string;
  fieldReviewerRoleKey: SettlementFieldReviewerRoleKey;
  engineeringDirectorUserId: string | null;
}

const MATERIAL_TYPES = new Set<string>(["material_purchase", "equipment_rental"]);
const ENGINEERING_TYPES = new Set<string>(["labor_subcontract", "professional_subcontract"]);

export async function freezeSettlementParticipants(
  input: FreezeSettlementParticipantsInput
): Promise<FrozenSettlementParticipants> {
  const contractTypeKey = input.contractTypeKey ?? "";
  if (!MATERIAL_TYPES.has(contractTypeKey) && !ENGINEERING_TYPES.has(contractTypeKey)) {
    throw new Error("当前合同类型不支持受治理结算参与人冻结");
  }
  if (!input.selectedUserId) {
    throw new Error("请选择所属项目当前有效人员");
  }

  const selectedMemberships = input.projectMembers.filter((member) =>
    member.projectId === input.projectId &&
    member.userId === input.selectedUserId &&
    member.userIsActive
  );
  if (selectedMemberships.length === 0) {
    throw new Error("只能选择所属项目当前有效人员");
  }

  const allowedRoles: SettlementFieldReviewerRoleKey[] = MATERIAL_TYPES.has(contractTypeKey)
    ? ["material_staff"]
    : ["engineering_foreman", "engineering_tech"];
  const matchedRoles = [...new Set(
    selectedMemberships
      .map((member) => member.roleKey)
      .filter((roleKey): roleKey is SettlementFieldReviewerRoleKey =>
        allowedRoles.includes(roleKey as SettlementFieldReviewerRoleKey)
      )
  )];
  if (matchedRoles.length !== 1) {
    throw new Error("所选人员岗位不符合当前结算类型");
  }

  let engineeringDirectorUserId: string | null = null;
  if (ENGINEERING_TYPES.has(contractTypeKey)) {
    const engineeringDirectorUserIds = [...new Set(
      input.projectMembers
        .filter((member) =>
          member.projectId === input.projectId &&
          member.roleKey === "engineering_director" &&
          member.userIsActive
        )
        .map((member) => member.userId)
    )];
    if (engineeringDirectorUserIds.length !== 1) {
      throw new Error("所属项目的项目总工配置缺失或冲突");
    }
    engineeringDirectorUserId = engineeringDirectorUserIds[0] ?? null;
  }

  return {
    fieldReviewerUserId: input.selectedUserId,
    fieldReviewerRoleKey: matchedRoles[0]!,
    engineeringDirectorUserId
  };
}
