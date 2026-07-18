import { canManageRole, requiresDepartmentBoundary, roleScope } from "./organization-management-policy";

describe("organization management policy", () => {
  it("固定部门主管下属岗位清单", () => {
    expect(canManageRole(["finance_director"], "finance_staff")).toBe(true);
    expect(canManageRole(["finance_director"], "contract_staff")).toBe(false);
    expect(canManageRole(["engineering_department_director"], "engineering_director")).toBe(true);
    expect(canManageRole(["engineering_department_director"], "project_manager")).toBe(false);
    expect(canManageRole(["comprehensive_director"], "employee")).toBe(false);
  });

  it("工程技术部成员和部长只能由董事长治理", () => {
    expect(canManageRole(["chairman"], "engineering_department_member")).toBe(true);
    expect(canManageRole(["general_manager"], "engineering_department_member")).toBe(false);
    expect(canManageRole(["general_manager"], "engineering_department_director")).toBe(false);
    expect(canManageRole(["super_admin"], "engineering_department_director")).toBe(false);
  });

  it("固定全局与项目岗位范围", () => {
    expect(roleScope("finance_staff")).toBe("global");
    expect(roleScope("contract_staff")).toBe("global");
    expect(roleScope("engineering_department_director")).toBe("global");
    expect(roleScope("engineering_department_member")).toBe("project");
    expect(roleScope("engineering_director")).toBe("project");
    expect(requiresDepartmentBoundary(["contract_director"])).toBe(true);
    expect(requiresDepartmentBoundary(["chairman"])).toBe(false);
  });
});
