import { normalizeBusinessAmount, sumBusinessAmounts, type RoleKey } from "@jiangkong/shared-domain";

export type PrincipalReturnStatus = "pending" | "approved" | "partially_paid" | "paid" | "rejected" | "withdrawn";
type Application = {
  status: PrincipalReturnStatus;
  requestedYuan: string;
  approvedYuan: string | null;
  paidYuan: string;
};
type Duty = {
  protocolVersion: 1;
  executionMode: "parallel";
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys: RoleKey[];
  roleScopesByRole: Partial<Record<RoleKey, "global" | "project">>;
};

export function principalReturnDuties(projectId: string | null): Duty[] {
  const groups: RoleKey[][] = [["comprehensive_director"]];
  if (projectId) groups.push(["project_manager"]);
  groups.push(["finance_director"], ["general_manager", "chairman"]);
  return groups.map(roleKeys => ({
    protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys, approvedRoleKeys: [],
    roleScopesByRole: Object.fromEntries(roleKeys.map(role=>[role,role === "project_manager" ? "project" : "global"])),
  }));
}

export function principalReturnAmounts(principalYuan: string, applications: readonly Application[]) {
  const paidYuan = sumBusinessAmounts(applications.map(row => row.paidYuan))!;
  const reservedYuan = sumBusinessAmounts(applications.map(row => {
    if (row.status === "pending") return row.requestedYuan;
    if (row.status === "approved" || row.status === "partially_paid") {
      return sumBusinessAmounts([row.approvedYuan, negative(row.paidYuan)])!;
    }
    return "0.0000";
  }))!;
  const availableYuan = sumBusinessAmounts([principalYuan, negative(paidYuan), negative(reservedYuan)])!;
  return { paidYuan, reservedYuan, availableYuan };
}

function negative(amountYuan: string) {
  return normalizeBusinessAmount(`-${amountYuan}`, { allowNegative: true })!;
}
